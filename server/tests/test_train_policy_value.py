import pytest

from server.ml.train_policy_value import resolve_device


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
