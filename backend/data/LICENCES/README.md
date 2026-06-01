# Licences — Référentiel et Pipeline de Données

Ce module gère la liste des licences vendables, leur import depuis un CSV, leur transformation en YAML validé, et leur exposition à l’UI.

Sommaire
- Formats et schéma cible
- Mapping CSV → YAML
- Script CLI (à venir) et usage
- Endpoints Admin (à venir)
- Bonnes pratiques (qualité des données)
- Exemple YAML

1) Formats et schéma cible

- Fichier cible: LICENCES/licences.yaml
- Schéma JSON: LICENCES/templates/licences_schema.json
- Structure YAML attendue:
  items:
    - sku: string|number
      name: string
      vendor: string
      edition: string|null
      description: string|null
      category: "licence"   # constant
      type: string|null
      unit: string
      pricing:
        public_price: number|string
        currency: "EUR"
        term: "monthly"|"annual"|"multiyear"|null
        engagement: number|string|null
      metadata:
        source: string|null
        version: string|null
        status: "active"|"deprecated"|null
        tags: [string, ...]

Remarques:
- price (facilité pour l’UI) n’est pas obligatoire dans YAML. Il est recalculé côté API depuis pricing.public_price.
- currency: EUR uniquement (normalisation obligatoire).
- term: valeurs normalisées: monthly, annual, multiyear.

2) Mapping CSV → YAML

Fichier source attendu par défaut:
- LICENCES/SOURCE/Pricing Licence - Oct 2025.csv
- Encodage recommandé: UTF-8 ou UTF-8-SIG (BOM). Le script gère automatiquement utf-8 et utf-8-sig.

Correspondance de colonnes (recommandée; la conversion tentera de détecter les variantes usuelles):
- sku: "SKU", "Ref", "Code", "Reference"
- name: "Name", "Produit", "Libellé", "Designation"
- vendor: "Vendor", "Editeur", "Publisher"
- edition: "Edition", "Plan", "SKU Edition"
- description: "Description", "Desc"
- type: "Type", "Family", "Gamme"
- unit: "Unit", "Unité", "UoM"
- pricing.public_price: "Public Price", "Prix Public", "List Price", "Price"
- pricing.currency: "Currency", "Devise" (normalisé en EUR)
- pricing.term: "Term", "Billing Term", "Period" (mapping: monthly→monthly, annual/yearly→annual, 3Y/36m→multiyear)
- pricing.engagement: "Engagement", "Commitment (months)", "Min Term"
- metadata.tags: "Tags" (séparés par , ; ou |)
- metadata.version: "Version"
- metadata.status: "Status" (normalisation: active/deprecated)

Règles de normalisation:
- public_price: convertir les virgules décimales en points, enlever les espaces insécables, supprimer les symboles monétaires.
- currency: forcer "EUR" si vide ou variante ("€", "eur", "EURO").
- term: 
  - "monthly", "mois", "per month" → monthly
  - "annual", "yearly", "par an", "12m" → annual
  - "24m", "36m", "3y", "multiyear" → multiyear
- engagement: convertir en entier si possible; sinon laisser string.
- tags: split sur [,;|], trim et dédupliquer.

3) Script CLI (à venir)

Chemin prévu:
- scripts/licenses_csv_to_yaml.py

Usage prévu:
- Conversion CSV → YAML (avec validation schéma)
  python scripts/licenses_csv_to_yaml.py \
    --input "LICENCES/SOURCE/Pricing Licence - Oct 2025.csv" \
    --output LICENCES/licences.yaml \
    --schema LICENCES/templates/licences_schema.json \
    --encoding utf-8-sig

Options:
- --input / -i: chemin CSV source
- --output / -o: chemin YAML cible
- --schema / -s: schéma JSON pour validation
- --encoding: utf-8 ou utf-8-sig (détection automatique par défaut)
- --delimiter: délimiteur CSV si non standard (détection automatique par défaut)
- --dry-run: ne pas écrire le YAML, afficher diagnostics
- --vendor, --term, --currency: surcharges globales (facultatives)
- --diagnostics: produit un rapport de normalisation/erreurs

Diagnostics attendus:
- lignes ignorées (raison)
- champs manquants
- conversions prix/devise effectuées
- normalisations de term/engagement
- stats (nb éléments valides, invalides)

4) Endpoints Admin (à venir)

Préfixe: /api/v1/admin/licenses (accès SUPER_ADMIN)
- POST /convert-csv
  Form-data: file=CSV (ou param path pour CSV déjà sur disque)
  Action: Convertit en YAML (sans écriture) et renvoie un aperçu + diagnostics.
- POST /validate-yaml
  Form-data: file=YAML (ou path)
  Action: Valide contre le schéma et renvoie diagnostics.
- POST /import-yaml
  Form-data: file=YAML (ou path)
  Action: Valide et écrit LICENCES/licences.yaml, puis met à jour l’exposition API.
Sécurité: require_min_role(3). Retour JSON avec “status”, “message”, “diagnostics”.

5) Bonnes pratiques (qualité des données)

- Encodage CSV: préférez UTF-8-SIG si export Excel/Office, UTF-8 sinon.
- Prix: utilisez '.' comme séparateur décimal côté CSV si possible. Le script tolère ','.
- Devise: explicitez "EUR" si colonne devise présente.
- Term: alignez sur monthly/annual/multiyear; sinon le script tentera le mapping.
- Unités: choisissez des unités claires (“user”, “device”, “core”, “instance”).
- Tags: utiles pour filtrer dans l’UI; pas d’espaces superflus.
- Edition: renseignez si pertinent (“Standard”, “Enterprise”, “E5”, etc.).

6) Exemple YAML

items:
  - sku: "MS-O365-E3"
    name: "Microsoft 365 E3"
    vendor: "Microsoft"
    edition: "E3"
    description: "Suite bureautique et services collaboratifs"
    category: "licence"
    type: "SaaS"
    unit: "user"
    pricing:
      public_price: 28.10
      currency: "EUR"
      term: "monthly"
      engagement: 12
    metadata:
      source: "CSV Oct 2025"
      version: "2025.10"
      status: "active"
      tags: ["office", "collaboration", "security"]

Notes
- L’API backend expose GET /api/v1/licenses (liste plate) et GET /api/v1/licenses/by-sku/{sku}
- La page UI /licenses exploite pricing.public_price pour l’affichage (champ price calculé côté API).
- Les fonctions d’export Excel UI seront ajoutées ultérieurement (xlsx-js-style).
