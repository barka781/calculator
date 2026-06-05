from app.architecture import calculate_architecture, calculate_managed_service_offer
from app.models import ArchitectureRequest, VmSpec


def _services_by_sku(result):
    return {s["sku"]: s for s in result["services_to_add"]}


def test_architecture_sizing_no_ha():
    request = ArchitectureRequest(
        vms=[VmSpec(name="app", vcpu=24, ram_gb=128, storage_gb=1000)],
        ha_required=False,
    )
    result = calculate_architecture(request)
    summary = result["architecture_summary"]

    # Marge de croissance +10% et ratio vCPU 3:1.
    assert summary["total_vcpu_required"] == 26.4
    assert summary["total_ram_required_gb"] == 140.8
    assert summary["physical_cores_required"] == 8.8
    assert summary["availability_zones"] == 1

    services = _services_by_sku(result)
    # Pas de zone de disponibilité sans HA.
    assert "csp:fr1:iaas:az:v1" not in services

    # Stockage bloc en Gio.
    bloc = services["csp:fr1:iaas:storage:bloc:medium:v1"]
    assert bloc["unit"] == "Gio"
    assert bloc["quantity"] == round((1000 + 140.8) * 1.1)

    # Backup converti en Tio (et non en Go) pour matcher l'unité de facturation du SKU.
    backup = services["csp:fr1:iaas:storage:backup:v1"]
    assert backup["unit"] == "Tio"
    expected_backup_tio = round((1000 + 140.8) * 1.1 * 2 / 1024, 2)
    assert backup["quantity"] == expected_backup_tio


def test_architecture_ha_forces_two_blades_and_az():
    request = ArchitectureRequest(
        vms=[VmSpec(name="small", vcpu=2, ram_gb=8, storage_gb=50)],
        ha_required=True,
    )
    result = calculate_architecture(request)
    services = _services_by_sku(result)

    assert services["csp:fr1:iaas:openiaas:standard:v3"]["quantity"] == 2
    assert services["csp:fr1:iaas:az:v1"]["quantity"] == 2
    assert result["architecture_summary"]["availability_zones"] == 2


def test_managed_service_tjm_mapping():
    result = calculate_managed_service_offer(
        [
            {"type": "vm", "os": "linux", "count": 20},
            {"type": "database", "technology": "postgresql", "count": 3},
        ]
    )
    by_sku = {s["sku"]: s for s in result["composed_services"]}

    # 0,1 jour/unité Linux ; 0,25 jour/unité PostgreSQL.
    assert by_sku["tjm:adm"]["quantity"] == 2.0
    assert by_sku["tjm:expert"]["quantity"] == 0.75
