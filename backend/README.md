# Cloud Temple Calculator Backend

Backend API public du calculateur Cloud Temple.

## Installation

```bash
cd calculator/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Lancement

```bash
uvicorn app.main:app --reload --port 8001
```

## Source des données

Le backend lit directement les YAML copiés depuis QuoteFlow :

- `data/CATALOGS/` pour le catalogue Cloud Temple et les prestations.
- `data/LICENCES/licences.yaml` pour les licences vendables.

Ces données ont le même format que les sources QuoteFlow, mais le service
reste autonome : pas de DB QuoteFlow, pas de Qdrant, pas d'auth QuoteFlow et
pas de Gemini.

## État de l'extraction

Le périmètre fiable du MVP est le flux catalogue + licences + panier/devis.
Les endpoints architecture, infogérance et appliances sont exposés pour poser
les futures briques fonctionnelles, mais ils restent simplifiés et doivent être
réalignés avec la logique QuoteFlow avant une utilisation métier complète.

## Endpoints

- `GET /health`
- `GET /api/catalog`
- `GET /api/catalog/{sku}`
- `GET /api/licenses`
- `GET /api/licenses/{sku}`
- `POST /api/quote`
- `POST /api/architecture/calculate`
- `POST /api/managed-services/calculate`
- `POST /api/appliances/{appliance_type}/offer`

### `GET /health`

Retourne l'état de l'API et le nombre d'items chargés.

```json
{
  "status": "ok",
  "catalog_items": 136,
  "license_items": 8834,
  "catalogs_dir": ".../backend/data/CATALOGS",
  "licences_file": ".../backend/data/LICENCES/licences.yaml"
}
```

### `GET /api/catalog`

Liste les produits du catalogue.

Paramètres :

- `q` : recherche texte sur SKU, nom, type, catégorie, description, specs.
- `category` : filtre partiel sur la catégorie.
- `type` : filtre partiel sur le type.
- `sub_type` : filtre partiel sur le sous-type.
- `include_deprecated` : inclure les items dépréciés ou retirés.
- `skip` / `limit` : pagination.

Exemple :

```bash
curl 'http://127.0.0.1:8001/api/catalog?q=storage&limit=5'
```

Réponse :

```json
{
  "status": "success",
  "items": [
    {
      "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
      "name": "Datastore Standard",
      "category": "Storage",
      "type": "Storage Flash",
      "sub_type": "Flash",
      "unit": "Gio",
      "pricing": { "public_price": 0.0756 },
      "pricing_summary": {
        "public_price": 0.0756,
        "discount_percent": 25,
        "discounted_price": 0.0567,
        "unit": "Gio",
        "base_quantity": 1,
        "min_quantity": 1
      }
    }
  ],
  "total": 1,
  "skip": 0,
  "limit": 5
}
```

### `GET /api/catalog/{sku}`

Retourne un item catalogue par SKU exact. Répond `404` si le SKU est introuvable.

### `GET /api/licenses`

Liste les licences.

Paramètres :

- `q` : recherche texte sur SKU, nom, description, vendor, édition, unité.
- `vendor` : filtre partiel sur l'éditeur.
- `skip` / `limit` : pagination.

Exemple :

```bash
curl 'http://127.0.0.1:8001/api/licenses?q=windows&limit=5'
```

### `GET /api/licenses/{sku}`

Retourne une licence par SKU exact. Répond `404` si le SKU est introuvable.

### `POST /api/quote`

Calcule un devis mensuel et périodique à partir d'un panier.

Requête :

```json
{
  "period_months": 12,
  "discount_percent": 25,
  "lines": [
    {
      "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
      "quantity": 1024,
      "source": "auto",
      "label": "Stockage bloc medium"
    }
  ]
}
```

Champs :

- `period_months` : durée de projection, de 1 à 120 mois.
- `discount_percent` : remise globale, de 0 à 100.
- `lines[].sku` : SKU catalogue ou licence.
- `lines[].quantity` : quantité strictement positive.
- `lines[].source` : `auto`, `catalog` ou `license`.
- `lines[].label` : libellé optionnel pour l'affichage.

Réponse :

```json
{
  "status": "success",
  "currency": "EUR",
  "period_months": 12,
  "discount_percent": 25,
  "lines": [
    {
      "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
      "name": "Stockage bloc medium",
      "source": "catalog",
      "unit": "Gio",
      "quantity": 1024,
      "public_unit_price": 0.0756,
      "discounted_unit_price": 0.0567,
      "monthly_total": 58.06
    }
  ],
  "monthly_public_total": 77.41,
  "monthly_discounted_total": 58.06,
  "period_public_total": 928.97,
  "period_discounted_total": 696.73,
  "savings_total": 232.24
}
```

### `POST /api/architecture/calculate`

Dimensionne une architecture simplifiée à partir de VMs.

Requête :

```json
{
  "ha_required": true,
  "vms": [
    { "name": "app", "vcpu": 4, "ram_gb": 16, "storage_gb": 100 },
    { "name": "db", "vcpu": 8, "ram_gb": 32, "storage_gb": 500 }
  ]
}
```

Réponse :

```json
{
  "status": "success",
  "architecture_summary": {
    "total_vms": 2,
    "total_vcpu_required": 13.2,
    "total_ram_required_gb": 52.8,
    "physical_cores_required": 4.4,
    "availability_zones": 2
  },
  "services_to_add": [
    {
      "sku": "csp:fr1:iaas:openiaas:standard:v3",
      "quantity": 2,
      "description": "Lames de calcul pour la production"
    }
  ]
}
```

### `POST /api/managed-services/calculate`

Compose des prestations d'infogérance à partir d'actifs.

Requête :

```json
{
  "assets": [
    { "type": "vm", "os": "linux", "count": 10 },
    { "type": "database", "technology": "postgresql", "count": 2 }
  ]
}
```

Réponse :

```json
{
  "status": "success",
  "composed_services": [
    {
      "sku": "tjm:adm",
      "quantity": 1.0,
      "unit": "Jour",
      "description": "Infogerance OS pour VMs Linux"
    },
    {
      "sku": "tjm:expert",
      "quantity": 0.5,
      "unit": "Jour",
      "description": "Infogerance BDD pour PostgreSQL"
    }
  ]
}
```

### `POST /api/appliances/{appliance_type}/offer`

Construit une offre appliance. Le type disponible dans le MVP est `nas-nfs`.

Requête :

```json
{
  "size_gb": 500
}
```

Réponse :

```json
{
  "status": "success",
  "composed_offer": {
    "build_items": [
      {
        "sku": "tjm:adm",
        "quantity": 0.25,
        "description": "Installation NAS NFS"
      }
    ],
    "run_items": [
      {
        "sku": "csp:fr1:iaas:openiaas:eco:v3",
        "quantity": 0.05,
        "description": "VM de service"
      },
      {
        "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
        "unit": "Go",
        "quantity": 550.0
      }
    ]
  }
}
```
