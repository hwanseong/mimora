from __future__ import annotations

import json
import math
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import mimora_worker


class MimoraWorkerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.storage_root = self.root / "rag"
        self.sources = self.root / "sources"
        self.sources.mkdir()

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_source(self, name: str, content: bytes) -> Path:
        path = self.sources / name
        path.write_bytes(content)
        return path

    def import_source(
        self,
        source_path: Path,
        workspace_ids: list[str] | None = None,
        security: str = "internal",
    ) -> dict:
        return mimora_worker.import_document(
            {
                "storage_root": str(self.storage_root),
                "source_path": str(source_path),
                "workspace_ids": workspace_ids or [],
                "security": security,
            }
        )

    def use_scored_test_embeddings(self, scores_by_marker: dict[str, float]) -> None:
        original_embeddings = mimora_worker.deterministic_test_embeddings

        def fake_embeddings(texts: list[str], dimension: int = 16) -> list[list[float]]:
            vectors: list[list[float]] = []
            for text in texts:
                score = 1.0 if "retrieval-query" in text else 0.0
                for marker, marker_score in scores_by_marker.items():
                    if marker in text:
                        score = marker_score
                        break
                score = max(-1.0, min(1.0, score))
                tail = math.sqrt(max(0.0, 1.0 - (score * score)))
                vector = [score, tail, *([0.0] * max(0, dimension - 2))]
                vectors.append(vector[:dimension])
            return vectors

        mimora_worker.deterministic_test_embeddings = fake_embeddings
        self.addCleanup(
            lambda: setattr(
                mimora_worker,
                "deterministic_test_embeddings",
                original_embeddings,
            )
        )

    def test_sqlite_creation_and_rag_id_generation(self) -> None:
        source = self.write_source("note.md", b"# Note")
        result = self.import_source(source)

        self.assertEqual(result["status"], "imported")
        self.assertRegex(result["document"]["ragDocumentId"], r"^RAG-\d{4}-\d{6}$")
        self.assertTrue((self.storage_root / "metadata.sqlite").exists())

    def test_md_import_and_row(self) -> None:
        source = self.write_source("note.md", b"# Note")
        result = self.import_source(source, ["WS-2026-0001"])
        document = result["document"]

        self.assertEqual(document["fileType"], ".md")
        self.assertEqual(document["status"], "imported")
        self.assertEqual(document["chunkCount"], 0)
        self.assertEqual(document["workspaceIds"], ["WS-2026-0001"])

        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            row_count = connection.execute("SELECT COUNT(*) FROM rag_documents").fetchone()[0]
            relation_count = connection.execute(
                "SELECT COUNT(*) FROM rag_document_workspaces"
            ).fetchone()[0]

        self.assertEqual(row_count, 1)
        self.assertEqual(relation_count, 1)

    def test_txt_import(self) -> None:
        result = self.import_source(self.write_source("memo.txt", b"memo"))
        self.assertEqual(result["document"]["fileType"], ".txt")

    def test_pdf_binary_import(self) -> None:
        result = self.import_source(self.write_source("contract.pdf", b"%PDF-1.4\nbinary"))
        self.assertEqual(result["document"]["fileType"], ".pdf")

    def test_docx_binary_import(self) -> None:
        result = self.import_source(self.write_source("report.docx", b"PK\x03\x04binary"))
        self.assertEqual(result["document"]["fileType"], ".docx")

    def test_managed_copy_exists_after_source_delete(self) -> None:
        source = self.write_source("memo.txt", b"memo")
        result = self.import_source(source)
        managed_path = Path(result["document"]["managedFilePath"])

        source.unlink()

        self.assertTrue(managed_path.exists())
        self.assertEqual(managed_path.read_bytes(), b"memo")

    def test_global_document_has_no_workspace_relations(self) -> None:
        result = self.import_source(self.write_source("global.md", b"# Global"))
        self.assertEqual(result["document"]["workspaceIds"], [])

    def test_duplicate_hash_is_blocked(self) -> None:
        first = self.import_source(self.write_source("first.txt", b"same"))
        duplicate = self.import_source(self.write_source("second.txt", b"same"))

        self.assertEqual(duplicate["status"], "duplicate")
        self.assertEqual(duplicate["duplicateOf"], first["document"]["ragDocumentId"])
        self.assertEqual(len(mimora_worker.list_documents({"storage_root": str(self.storage_root)})), 1)

    def test_delete_removes_managed_copy_and_db_rows(self) -> None:
        result = self.import_source(self.write_source("delete.txt", b"delete"))
        rag_id = result["document"]["ragDocumentId"]
        managed_path = Path(result["document"]["managedFilePath"])

        deleted = mimora_worker.delete_document(
            {"storage_root": str(self.storage_root), "rag_document_id": rag_id}
        )

        self.assertTrue(deleted["deleted"])
        self.assertFalse(managed_path.exists())
        self.assertEqual(mimora_worker.list_documents({"storage_root": str(self.storage_root)}), [])

    def test_replace_keeps_same_rag_id_and_resets_metadata(self) -> None:
        result = self.import_source(self.write_source("old.txt", b"old"))
        rag_id = result["document"]["ragDocumentId"]
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "embedding_provider": "test",
            }
        )
        replacement = self.write_source("new.md", b"# New")

        replaced = mimora_worker.replace_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "source_path": str(replacement),
            }
        )

        self.assertEqual(replaced["status"], "replaced")
        self.assertEqual(replaced["document"]["ragDocumentId"], rag_id)
        self.assertEqual(replaced["document"]["fileType"], ".md")
        self.assertEqual(replaced["document"]["status"], "imported")
        self.assertIsNone(replaced["document"]["indexedAt"])
        self.assertIsNone(replaced["document"]["embeddingProvider"])
        self.assertIsNone(replaced["document"]["embeddingModel"])
        self.assertEqual(replaced["document"]["chunkCount"], 0)

        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            chunk_count = connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
        self.assertEqual(chunk_count, 0)

    def test_replace_same_hash_is_unchanged(self) -> None:
        result = self.import_source(self.write_source("same.txt", b"same"))
        rag_id = result["document"]["ragDocumentId"]

        replaced = mimora_worker.replace_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "source_path": str(self.write_source("same-again.txt", b"same")),
            }
        )

        self.assertEqual(replaced["status"], "unchanged")
        self.assertEqual(replaced["document"]["ragDocumentId"], rag_id)

    def test_replace_duplicate_hash_is_blocked(self) -> None:
        first = self.import_source(self.write_source("first.txt", b"first"))
        second = self.import_source(self.write_source("second.txt", b"second"))

        replaced = mimora_worker.replace_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": second["document"]["ragDocumentId"],
                "source_path": str(self.write_source("first-copy.txt", b"first")),
            }
        )

        self.assertEqual(replaced["status"], "duplicate")
        self.assertEqual(replaced["duplicateOf"], first["document"]["ragDocumentId"])

    def test_unsupported_extension_rejected(self) -> None:
        with self.assertRaises(mimora_worker.WorkerError) as context:
            self.import_source(self.write_source("sheet.xlsx", b"not-rag"))

        self.assertEqual(context.exception.code, "unsupported_file_type")

    def test_source_file_not_found(self) -> None:
        with self.assertRaises(mimora_worker.WorkerError) as context:
            self.import_source(self.sources / "missing.md")

        self.assertEqual(context.exception.code, "source_file_not_found")

    def test_markdown_extraction_excludes_frontmatter_and_groups_headings(self) -> None:
        source = self.write_source(
            "frontmatter.md",
            b"---\ndocument_id: DOC-2026-0001\n---\n# Kickoff\nBody\n## Risk\nRisk body\n",
        )
        extraction = mimora_worker.extract_markdown(source)

        self.assertEqual(len(extraction["sections"]), 2)
        self.assertEqual(extraction["sections"][0]["heading"], "Kickoff")
        self.assertNotIn("document_id", extraction["sections"][0]["text"])

    def test_txt_extraction(self) -> None:
        source = self.write_source("memo.txt", "첫 줄\n\n둘째 줄".encode("utf-8"))
        extraction = mimora_worker.extract_text(source)

        self.assertEqual(len(extraction["sections"]), 1)
        self.assertIn("첫 줄", extraction["sections"][0]["text"])

    def test_chunking_preserves_heading_and_splits_long_section(self) -> None:
        extraction = {
            "sections": [
                {
                    "section_index": 0,
                    "heading": "Long",
                    "page": None,
                    "text": "\n\n".join(["paragraph"] * 900),
                }
            ]
        }
        chunks = mimora_worker.build_chunks("RAG-2026-000001", extraction, 10)

        self.assertGreater(len(chunks), 1)
        self.assertEqual(chunks[0].heading, "Long")
        self.assertEqual(chunks[0].faiss_vector_id, 10)

    def test_index_with_test_provider_saves_chunks_and_updates_document(self) -> None:
        result = self.import_source(
            self.write_source("indexed.md", b"# Alpha\nAlpha risk\n\n# Beta\nBeta schedule"),
            ["WS-2026-0001"],
        )
        rag_id = result["document"]["ragDocumentId"]
        indexed = mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "embedding_provider": "test",
            }
        )

        self.assertEqual(indexed["status"], "indexed")
        self.assertEqual(indexed["document"]["status"], "indexed")
        self.assertGreater(indexed["document"]["chunkCount"], 0)
        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            chunk_count = connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
        self.assertEqual(chunk_count, indexed["document"]["chunkCount"])

    def test_search_filters_workspace_and_global_scope(self) -> None:
        global_doc = self.import_source(self.write_source("global.txt", b"global policy"))
        ws_doc = self.import_source(self.write_source("workspace.txt", b"workspace risk"), ["WS-2026-0001"])
        other_doc = self.import_source(self.write_source("other.txt", b"other workspace"), ["WS-2026-0002"])

        for document in (global_doc, ws_doc, other_doc):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": document["document"]["ragDocumentId"],
                    "embedding_provider": "test",
                }
            )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "workspace risk",
                "workspace_ids": ["WS-2026-0001"],
                "include_global": True,
                "security": "internal",
                "top_k": 10,
                "embedding_provider": "test",
                "similarity_threshold": -1,
            }
        )
        result_ids = {result["ragDocumentId"] for result in results}

        self.assertIn(global_doc["document"]["ragDocumentId"], result_ids)
        self.assertIn(ws_doc["document"]["ragDocumentId"], result_ids)
        self.assertNotIn(other_doc["document"]["ragDocumentId"], result_ids)

    def test_search_applies_threshold_and_allows_empty_results(self) -> None:
        self.use_scored_test_embeddings({"above-threshold": 0.31, "below-threshold": 0.19})
        above_doc = self.import_source(self.write_source("above.txt", b"above-threshold"))
        below_doc = self.import_source(self.write_source("below.txt", b"below-threshold"))

        for document in (above_doc, below_doc):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": document["document"]["ragDocumentId"],
                    "embedding_provider": "test",
                }
            )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.25,
                "dense_only_threshold": 0.25,
                "workspace_score_bonus": 0.0,
            }
        )

        self.assertEqual([result["ragDocumentId"] for result in results], [above_doc["document"]["ragDocumentId"]])

        empty_results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.95,
            }
        )

        self.assertEqual(empty_results, [])

    def test_fts_index_is_created_and_preserves_korean_lexical_results(self) -> None:
        self.use_scored_test_embeddings({"korean-lexical": 0.05})
        document = self.import_source(
            self.write_source(
                "korean.md",
                "korean-lexical 일정 소화율 보정 기준과 주간 보고 검토".encode("utf-8"),
            )
        )
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": document["document"]["ragDocumentId"],
                "embedding_provider": "test",
            }
        )

        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            fts_table = connection.execute(
                "SELECT name FROM sqlite_master WHERE name = 'rag_chunks_fts'"
            ).fetchone()
            fts_count = connection.execute("SELECT COUNT(*) FROM rag_chunks_fts").fetchone()[0]

        self.assertIsNotNone(fts_table)
        self.assertGreater(fts_count, 0)

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query 일정 소화율",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.9,
            }
        )

        self.assertEqual([result["ragDocumentId"] for result in results], [document["document"]["ragDocumentId"]])
        self.assertIsNotNone(results[0]["lexicalRank"])

    def test_hybrid_candidate_union_keeps_dense_only_and_lexical_only(self) -> None:
        self.use_scored_test_embeddings(
            {
                "dense-only": 0.61,
                "lexical-only": 0.05,
            }
        )
        dense_doc = self.import_source(self.write_source("dense.txt", b"dense-only"))
        lexical_doc = self.import_source(
            self.write_source("lexical.txt", "lexical-only 일정 지연 교훈".encode("utf-8"))
        )

        for document in (dense_doc, lexical_doc):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": document["document"]["ragDocumentId"],
                    "embedding_provider": "test",
                }
            )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query 일정 지연",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.3,
                "workspace_score_bonus": 0.0,
            }
        )
        result_ids = {result["ragDocumentId"] for result in results}

        self.assertIn(dense_doc["document"]["ragDocumentId"], result_ids)
        self.assertIn(lexical_doc["document"]["ragDocumentId"], result_ids)
        self.assertTrue(any(result["lexicalRank"] for result in results))

    def test_filename_is_indexed_as_lexical_signal(self) -> None:
        self.use_scored_test_embeddings({"filename-body": 0.05})
        document = self.import_source(
            self.write_source(
                "2026-09-07_report_schedule_burn_rate_lesson.txt",
                b"filename-body body without target phrase",
            )
        )
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": document["document"]["ragDocumentId"],
                "embedding_provider": "test",
            }
        )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query burn rate",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.9,
            }
        )

        self.assertEqual([result["ragDocumentId"] for result in results], [document["document"]["ragDocumentId"]])
        self.assertIsNotNone(results[0]["lexicalRank"])

    def test_no_lexical_and_weak_dense_returns_no_results(self) -> None:
        self.use_scored_test_embeddings({"weak-dense": 0.12})
        document = self.import_source(self.write_source("weak.txt", b"weak-dense"))
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": document["document"]["ragDocumentId"],
                "embedding_provider": "test",
            }
        )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query unrelated keyword",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.3,
            }
        )

        self.assertEqual(results, [])

    def test_search_applies_workspace_bonus_and_scope_ordering(self) -> None:
        self.use_scored_test_embeddings(
            {
                "workspace-match": 0.58,
                "global-match": 0.60,
                "other-workspace-match": 0.99,
            }
        )
        workspace_doc = self.import_source(
            self.write_source("workspace-match.txt", b"workspace-match"),
            ["WS-2026-0001"],
        )
        global_doc = self.import_source(self.write_source("global-match.txt", b"global-match"))
        other_doc = self.import_source(
            self.write_source("other-workspace-match.txt", b"other-workspace-match"),
            ["WS-2026-0002"],
        )

        for document in (workspace_doc, global_doc, other_doc):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": document["document"]["ragDocumentId"],
                    "embedding_provider": "test",
                }
            )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query",
                "workspace_ids": ["WS-2026-0001"],
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.0,
                "workspace_score_bonus": 0.03,
            }
        )

        self.assertEqual(results[0]["ragDocumentId"], workspace_doc["document"]["ragDocumentId"])
        self.assertEqual(results[0]["scope"], "workspace")
        self.assertAlmostEqual(results[0]["denseScore"], 0.58)
        self.assertEqual(results[0]["denseRank"], 3)
        self.assertIsNone(results[0]["lexicalRank"])
        self.assertGreater(results[0]["adjustedScore"], results[1]["adjustedScore"])
        self.assertEqual(results[1]["ragDocumentId"], global_doc["document"]["ragDocumentId"])
        self.assertEqual(results[1]["scope"], "global")
        result_ids = {result["ragDocumentId"] for result in results}
        self.assertNotIn(other_doc["document"]["ragDocumentId"], result_ids)

    def test_search_limits_chunks_per_document_and_can_return_less_than_top_k(self) -> None:
        self.use_scored_test_embeddings(
            {
                "same-doc-one": 0.91,
                "same-doc-two": 0.90,
                "same-doc-three": 0.89,
                "second-doc": 0.88,
            }
        )
        same_doc = self.import_source(
            self.write_source(
                "same.md",
                b"# One\nsame-doc-one\n\n# Two\nsame-doc-two\n\n# Three\nsame-doc-three",
            )
        )
        second_doc = self.import_source(self.write_source("second.txt", b"second-doc"))

        for document in (same_doc, second_doc):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": document["document"]["ragDocumentId"],
                    "embedding_provider": "test",
                }
            )

        results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.0,
                "max_chunks_per_document": 2,
            }
        )

        self.assertEqual(len(results), 3)
        self.assertEqual(
            sum(1 for result in results if result["ragDocumentId"] == same_doc["document"]["ragDocumentId"]),
            2,
        )
        self.assertIn(second_doc["document"]["ragDocumentId"], {result["ragDocumentId"] for result in results})
        self.assertEqual(
            [result["adjustedScore"] for result in results],
            sorted([result["adjustedScore"] for result in results], reverse=True),
        )

    def test_reindex_keeps_fts_chunk_rows_synchronized(self) -> None:
        result = self.import_source(self.write_source("reindex.md", b"# One\nreindex-sync"))
        rag_id = result["document"]["ragDocumentId"]

        for _ in range(2):
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": rag_id,
                    "embedding_provider": "test",
                }
            )

        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            chunk_count = connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
            fts_count = connection.execute("SELECT COUNT(*) FROM rag_chunks_fts").fetchone()[0]

        self.assertEqual(chunk_count, fts_count)

    def test_replace_removes_old_fts_terms_after_reindex(self) -> None:
        self.use_scored_test_embeddings({"old-term": 0.05, "new-term": 0.05})
        result = self.import_source(self.write_source("replace-old.txt", b"old-term"))
        rag_id = result["document"]["ragDocumentId"]
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "embedding_provider": "test",
            }
        )
        mimora_worker.replace_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "source_path": str(self.write_source("replace-new.txt", b"new-term")),
            }
        )
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "embedding_provider": "test",
            }
        )

        old_results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query old-term",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.9,
            }
        )
        new_results = mimora_worker.search_documents(
            {
                "storage_root": str(self.storage_root),
                "query": "retrieval-query new-term",
                "include_global": True,
                "security": "internal",
                "top_k": 5,
                "embedding_provider": "test",
                "similarity_threshold": 0.9,
            }
        )

        self.assertEqual(old_results, [])
        self.assertEqual([result["ragDocumentId"] for result in new_results], [rag_id])

    def test_delete_indexed_document_removes_chunks(self) -> None:
        result = self.import_source(self.write_source("delete-indexed.txt", b"delete indexed"))
        rag_id = result["document"]["ragDocumentId"]
        mimora_worker.index_document(
            {
                "storage_root": str(self.storage_root),
                "rag_document_id": rag_id,
                "embedding_provider": "test",
            }
        )

        mimora_worker.delete_document(
            {"storage_root": str(self.storage_root), "rag_document_id": rag_id}
        )

        with sqlite3.connect(self.storage_root / "metadata.sqlite") as connection:
            chunk_count = connection.execute("SELECT COUNT(*) FROM rag_chunks").fetchone()[0]
            fts_count = connection.execute("SELECT COUNT(*) FROM rag_chunks_fts").fetchone()[0]
        self.assertEqual(chunk_count, 0)
        self.assertEqual(fts_count, 0)

    def test_private_document_external_embedding_is_blocked(self) -> None:
        result = self.import_source(
            self.write_source("private.txt", b"private"),
            security="private",
        )

        with self.assertRaises(mimora_worker.WorkerError) as context:
            mimora_worker.index_document(
                {
                    "storage_root": str(self.storage_root),
                    "rag_document_id": result["document"]["ragDocumentId"],
                    "embedding_provider": "openai",
                    "openai_api_key": "sk-test",
                }
            )

        self.assertEqual(context.exception.code, "private_requires_local_embedding")

    def test_runtime_command_returns_json_only_on_stdout(self) -> None:
        result = subprocess.run(
            [sys.executable, str(Path(mimora_worker.__file__)), "runtime-check"],
            input="{}",
            capture_output=True,
            check=True,
            text=True,
        )
        payload = json.loads(result.stdout)

        self.assertTrue(payload["ok"])
        self.assertTrue(payload["data"]["available"])
        self.assertEqual(result.stderr, "")


if __name__ == "__main__":
    unittest.main()
