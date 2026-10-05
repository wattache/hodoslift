import logging

from app.socle.audit import log_write


def test_log_write_emet_un_record_audit(caplog):
    with caplog.at_level(logging.INFO):
        log_write(
            uid="u",
            resource="daily_log",
            doc_path="athletes/a1/dailyLogs/2026-01-15",
            fields=["sleep", "weight"],
        )

    audit_records = [r for r in caplog.records if hasattr(r, "audit_fields")]
    record = audit_records[-1]
    audit_fields = record.audit_fields

    assert audit_fields["audit"] is True
    assert audit_fields["action"] == "write"
    assert audit_fields["resource"] == "daily_log"
    assert audit_fields["uid"] == "u"
    assert audit_fields["fields"] == ["sleep", "weight"]
    assert audit_fields["status"] == "ok"


def test_log_write_ne_fuite_aucune_valeur_de_sante(caplog):
    with caplog.at_level(logging.INFO):
        log_write(
            uid="u",
            resource="daily_log",
            doc_path="athletes/a1/dailyLogs/2026-01-15",
            fields=["sleep", "weight"],
        )

    audit_records = [r for r in caplog.records if hasattr(r, "audit_fields")]
    record = audit_records[-1]
    fields = record.audit_fields["fields"]

    assert all(isinstance(f, str) for f in fields)
    assert not any(isinstance(f, (int, float)) for f in fields)
