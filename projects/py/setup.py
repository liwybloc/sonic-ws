# Copyright (c) 2026 Lily (liwybloc)
#
# Licensed for personal, non-commercial use only.
# Commercial use, redistribution, sublicensing, sale, rental, lease,
# or inclusion in a paid product or service is prohibited without prior
# written permission from the copyright holder.
#
# See the LICENSE file in the project root for the full license terms.
#
# License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026

import pathlib
import shutil
import subprocess
import sys

from setuptools import Distribution, setup
from setuptools.command.build_py import build_py
from setuptools.command.bdist_wheel import bdist_wheel
from setuptools.command.sdist import sdist

PROJECT = pathlib.Path(__file__).resolve().parent
VENDOR = PROJECT / "vendor"
CORE = VENDOR / "core" if (VENDOR / "core").is_dir() else PROJECT.parent / "core"


class BinaryDistribution(Distribution):
    def has_ext_modules(self):
        return True


class PlatformWheel(bdist_wheel):
    """The ctypes ABI is Python-independent, but the wheel is platform-specific."""

    def get_tag(self):
        _python, _abi, platform = super().get_tag()
        return "py3", "none", platform


class BuildPy(build_py):
    def run(self):
        subprocess.run(
            [
                "cargo",
                "build",
                "--release",
                "--features",
                "python",
                "--manifest-path",
                str(CORE / "Cargo.toml"),
            ],
            check=True,
        )
        super().run()

        # Prevent browser assets from older builds leaking into Python wheels.
        shutil.rmtree(
            pathlib.Path(self.build_lib) / "sonic_ws" / "_browser",
            ignore_errors=True,
        )

        names = {"win32": "sonic_ws_core.dll", "darwin": "libsonic_ws_core.dylib"}
        source = CORE / "target" / "release" / names.get(
            sys.platform, "libsonic_ws_core.so"
        )
        target = pathlib.Path(self.build_lib) / "sonic_ws" / ("_native" + source.suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)

class SourceDistribution(sdist):
    """Stage external workspace inputs so the published sdist is self-contained."""

    def run(self):
        shutil.rmtree(VENDOR, ignore_errors=True)
        shutil.copytree(
            PROJECT.parent / "core",
            VENDOR / "core",
            ignore=shutil.ignore_patterns("target", "node_modules", ".git", "*.node"),
        )
        try:
            super().run()
        finally:
            shutil.rmtree(VENDOR, ignore_errors=True)


setup(
    cmdclass={
        "build_py": BuildPy,
        "bdist_wheel": PlatformWheel,
        "sdist": SourceDistribution,
    },
    distclass=BinaryDistribution,
)
