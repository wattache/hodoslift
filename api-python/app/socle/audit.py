"""Journal d'audit des écritures médiées.

Les lignes émises ici sont requêtables dans Cloud Logging via le filtre
`jsonPayload.audit=true`. Ne loggue jamais les valeurs des champs — ce sont
des données de santé ; seuls les noms de champs sont tracés.
"""

import logging

logger = logging.getLogger(__name__)


def log_write(
    uid: str,
    resource: str,
    doc_path: str,
    fields: list[str],
    status: str = "ok",
    count: int | None = None,
) -> None:
    """Émet une ligne d'audit pour une écriture médiée.

    `count` est un COMPTEUR structurel (ex. nb de docs supprimés en cascade),
    jamais une valeur métier — porté par une clé séparée de `fields`, qui
    reste une liste de NOMS uniquement (invariant vérifié par test_audit.py).
    """
    audit_fields = {
        "audit": True,
        "action": "write",
        "resource": resource,
        "uid": uid,
        "docPath": doc_path,
        "fields": fields,
        "status": status,
    }
    if count is not None:
        audit_fields["count"] = count

    logger.info(
        "audit write %s %s",
        resource,
        doc_path,
        extra={"audit_fields": audit_fields},
    )