"""brokkr — l'API de French Forge Trainer (FastAPI, Postgres).

Nommé d'après le nain qui forgea Mjöllnir. Médie les lectures et les écritures
du client vers Postgres : valide le payload (Pydantic), tranche l'autorisation
et applique une sémantique d'écriture explicite — pour qu'aucune écriture
malformée n'entre.
"""
