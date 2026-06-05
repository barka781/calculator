from __future__ import annotations

from math import ceil
from typing import Any

from .models import ArchitectureRequest


def calculate_architecture(request: ArchitectureRequest) -> dict[str, Any]:
    total_vcpu = sum(vm.vcpu for vm in request.vms)
    total_ram_gb = sum(vm.ram_gb for vm in request.vms)
    total_storage_gb = sum(vm.storage_gb for vm in request.vms)

    vcpu_required = total_vcpu * 1.1
    ram_required_gb = total_ram_gb * 1.1
    physical_cores_required = vcpu_required / 3

    blade_sku = "csp:fr1:iaas:openiaas:standard:v3"
    blade_cores = 64
    blade_ram_gb = 256
    num_blades = max(ceil(physical_cores_required / blade_cores), ceil(ram_required_gb / blade_ram_gb), 1)

    if request.ha_required:
        num_blades = max(2, num_blades)

    block_storage_gb = (total_storage_gb + ram_required_gb) * 1.1
    backup_storage_gb = block_storage_gb * 2
    # Le SKU backup (csp:fr1:iaas:storage:backup:v1) est facturé en Tio, pas en Go.
    # QuoteFlow envoie ici une quantité en Go vers un prix au Tio (bug ×1024) ; on convertit.
    backup_storage_tio = backup_storage_gb / 1024

    services_to_add = [
        {
            "sku": blade_sku,
            "quantity": int(num_blades),
            "description": "Lames de calcul pour la production",
        },
        {
            "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
            "quantity": round(block_storage_gb),
            "unit": "Gio",
            "description": "Stockage bloc pour VMs",
        },
        {
            "sku": "csp:fr1:iaas:storage:backup:v1",
            "quantity": round(backup_storage_tio, 2),
            "unit": "Tio",
            "description": "Stockage pour sauvegardes",
        },
    ]

    if request.ha_required:
        services_to_add.append(
            {
                "sku": "csp:fr1:iaas:az:v1",
                "quantity": 2,
                "description": "Zones de disponibilite",
            }
        )

    return {
        "status": "success",
        "architecture_summary": {
            "total_vms": len(request.vms),
            "total_vcpu_required": round(vcpu_required, 2),
            "total_ram_required_gb": round(ram_required_gb, 2),
            "physical_cores_required": round(physical_cores_required, 2),
            "availability_zones": 2 if request.ha_required else 1,
        },
        "services_to_add": services_to_add,
    }


def calculate_managed_service_offer(assets: list[dict[str, Any]]) -> dict[str, Any]:
    rules = {
        "vm_linux": {
            "sku": "tjm:adm",
            "days_per_unit": 0.1,
            "description": "Infogerance OS pour VMs Linux",
        },
        "db_postgresql": {
            "sku": "tjm:expert",
            "days_per_unit": 0.25,
            "description": "Infogerance BDD pour PostgreSQL",
        },
    }
    composed_services: dict[str, dict[str, Any]] = {}

    for asset in assets:
        asset_type = asset.get("type")
        count = float(asset.get("count") or 0)

        rule_key = None
        if asset_type == "vm" and asset.get("os") == "linux":
            rule_key = "vm_linux"
        elif asset_type == "database" and asset.get("technology") == "postgresql":
            rule_key = "db_postgresql"

        if not rule_key:
            continue

        rule = rules[rule_key]
        sku = rule["sku"]
        composed_services.setdefault(
            sku,
            {"quantity": 0.0, "unit": "Jour", "description": rule["description"]},
        )
        composed_services[sku]["quantity"] += count * rule["days_per_unit"]

    return {
        "status": "success",
        "composed_services": [
            {
                "sku": sku,
                "quantity": round(data["quantity"], 2),
                "unit": data["unit"],
                "description": data["description"],
            }
            for sku, data in composed_services.items()
        ],
    }


def build_service_appliance_offer(appliance_type: str, specs: dict[str, Any]) -> dict[str, Any]:
    blueprints = {
        "nas-nfs": {
            "build_items": [
                {
                    "sku": "tjm:adm",
                    "quantity": 0.25,
                    "description": "Installation NAS NFS",
                }
            ],
            "run_items": [
                {
                    "sku": "csp:fr1:iaas:openiaas:eco:v3",
                    "quantity": 0.05,
                    "description": "VM de service",
                },
                {
                    "sku": "csp:fr1:iaas:storage:bloc:medium:v1",
                    "quantity_factor": 1.1,
                    "unit": "Go",
                },
            ],
        }
    }

    blueprint = blueprints.get(appliance_type)
    if not blueprint:
        return {"status": "error", "message": f"Appliance type '{appliance_type}' not found."}

    size_gb = float(specs.get("size_gb") or 100)
    run_items = []
    for item in blueprint["run_items"]:
        line = dict(item)
        if "quantity_factor" in line:
            line["quantity"] = size_gb * line.pop("quantity_factor")
        run_items.append(line)

    return {
        "status": "success",
        "composed_offer": {
            "build_items": blueprint["build_items"],
            "run_items": run_items,
        },
    }
