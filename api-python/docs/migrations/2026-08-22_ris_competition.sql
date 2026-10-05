-- LE RIS SE DÉRIVE DES COMPÉTITIONS, comme le score (FRE-92).
--
-- ⚠️ NI TABLE, NI COLONNE, NI RECALCUL — et c'est ce projet qui l'avait déjà
-- écrit, deux lignes au-dessus de cette vue : « Le score n'est PAS stocké (il
-- divergeait côté Firestore, au point que brokkr le recalculait serveur) ». Le
-- RIS est du même bois : le stocker rouvrirait la même plaie, un jury corrigeant
-- un essai après coup suffisant à désynchroniser la valeur.
--
-- ⚠️ POURQUOI IL N'Y A PLUS RIEN À FIGER. Un RIS vaut pour un poids donné : il
-- lui faut le total ET le poids obtenus ENSEMBLE. La table des 1RM ne peut pas
-- le garantir — le poids vit sur `athletes`, les 1RM ailleurs, saisis à deux
-- moments — d'où l'idée d'un instantané stocké. Mais `competition_participants`
-- fige DÉJÀ les deux : `bodyweight_kg` y est le poids du jour, les essais
-- appartiennent à cette participation. L'appariement est intrinsèque à la ligne.
--
-- Décision du 21/08 : le RIS ne vient QUE des compétitions. Il en découle que
-- 55 athlètes sur 59 n'en ont pas, et c'est assumé — « c'est un outil de
-- compétition, pas un truc qu'on calcule en faisant un PR toutes les semaines ».
-- Quatre RIS réels valent mieux que cinquante estimations qu'on ne sait pas
-- tenir à jour. (Compté sur Neon le 22/08, depuis cette vue même.)
--
-- ⚠️ LA VUE EXISTANTE EST ÉTENDUE, pas doublée : les deux agrégats parcourent
-- exactement les mêmes lignes (participants × essais). Une seconde vue ferait
-- deux balayages pour une seule question.

BEGIN;

CREATE OR REPLACE VIEW competition_scores AS
WITH meilleurs AS (
    -- Le meilleur essai RÉUSSI, par participant et par mouvement.
    SELECT a.participant_id,
           upper(m.movement) AS movement,
           max(a.weight_kg)  AS weight_kg
    FROM competition_attempts a
    JOIN competition_movements m ON m.id = a.movement_id
    WHERE a.result = 'rep'
    GROUP BY a.participant_id, upper(m.movement)
)
SELECT p.id             AS participant_id,
       p.competition_id,
       -- Inchangé : le SCORE de l'épreuve additionne TOUS les mouvements
       -- disputés, quels qu'ils soient.
       COALESCE(SUM(b.weight_kg), 0) AS score,

       -- ── Ajouts FRE-92, en fin de liste pour ne pas déplacer l'existant ──
       p.athlete_id,

       -- ⚠️ LE TOTAL DU BARÈME N'EST PAS LE SCORE. Quatre places, pas tous les
       -- mouvements — et le pull up et le chin up S'EN DISPUTENT UNE, on retient
       -- le plus lourd. Le front l'ignore : il écarte purement le chin up, ce qui
       -- sous-estime le total de ONZE athlètes mesurés le 21/08.
       -- (Onze par la TABLE DES 1RM, que le RIS ne lit plus ; en compétition,
       -- aucun chin up n'a encore été disputé — la règle attend la première.)
       COALESCE(SUM(b.weight_kg) FILTER (
           WHERE b.movement IN ('MUSCLE UP', 'DIPS', 'SQUAT')), 0)
       + COALESCE(MAX(b.weight_kg) FILTER (
           WHERE b.movement IN ('PULL UP', 'CHIN UP')), 0) AS total_bareme_kg,

       -- Les deux entrées du barème, figées le jour de la compétition. C'est ce
       -- couple qui rend le RIS honnête, et c'est la ligne qui le garantit.
       p.bodyweight_kg,
       p.gender
FROM competition_participants p
LEFT JOIN meilleurs b ON b.participant_id = p.id
-- `p.id` est clé primaire : Postgres autorise à projeter les autres colonnes de
-- `p` sans les grouper (dépendance fonctionnelle).
GROUP BY p.id, p.competition_id;

COMMIT;

-- ⚠️ LE BARÈME LUI-MÊME RESTE EN PYTHON (`app/scoring.py`). Dix constantes par
-- genre et une exponentielle n'ont rien à faire dans une définition de vue : ce
-- sont des règles métier, elles sont gardées par des tests différentiels qui les
-- comparent au chiffre près à l'implémentation d'origine. Le SQL agrège, Python
-- applique le barème — chacun ce qu'il sait faire.

-- Vérification :
--
--   SELECT participant_id, score, total_bareme_kg, bodyweight_kg, gender
--   FROM competition_scores WHERE athlete_id IS NOT NULL LIMIT 5;
