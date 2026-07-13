import pytest

from server.ml.train_policy_value import resolve_device, unique_output_path


class FakeCuda:
    def __init__(self, available):
        self.available = available

    def is_available(self):
        return self.available


class FakeMps:
    def __init__(self, available):
        self.available = available

    def is_available(self):
        return self.available


class FakeBackends:
    def __init__(self, mps_available):
        self.mps = FakeMps(mps_available)


class FakeTorch:
    def __init__(self, cuda_available=False, mps_available=False):
        self.cuda = FakeCuda(cuda_available)
        self.backends = FakeBackends(mps_available)

    def device(self, name):
        return name


def test_resolve_device_prefers_cuda_for_auto():
    assert resolve_device(FakeTorch(cuda_available=True, mps_available=True), "auto") == "cuda"


def test_resolve_device_uses_mps_before_cpu_for_auto():
    assert resolve_device(FakeTorch(mps_available=True), "auto") == "mps"


def test_resolve_device_rejects_unavailable_cuda():
    with pytest.raises(SystemExit, match="CUDA is not available"):
        resolve_device(FakeTorch(cuda_available=False), "cuda")


def test_unique_output_path_appends_timestamp_and_uuid():
    output_path = unique_output_path("server/models/simpei_policy_value.pt")

    assert output_path.parent.as_posix() == "server/models"
    assert output_path.name.startswith("simpei_policy_value_")
    assert output_path.suffix == ".pt"
    assert output_path.name != "simpei_policy_value.pt"


def test_unique_output_path_preserves_custom_template_stem():
    output_path = unique_output_path("server/models/custom_model.pt")

    assert output_path.name.startswith("custom_model_")
    assert output_path.suffix == ".pt"
