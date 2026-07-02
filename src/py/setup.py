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

import pathlib, shutil, subprocess, sys
from setuptools import Distribution, setup
from setuptools.command.build_py import build_py

ROOT = pathlib.Path(__file__).resolve().parents[1]


class BinaryDistribution(Distribution):
    def has_ext_modules(self):
        return True


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
                str(ROOT / "core" / "Cargo.toml"),
            ],
            check=True,
        )
        super().run()
        names = {"win32": "sonic_ws_core.dll", "darwin": "libsonic_ws_core.dylib"}
        source = (
            ROOT
            / "core"
            / "target"
            / "release"
            / names.get(sys.platform, "libsonic_ws_core.so")
        )
        suffix = source.suffix
        target = pathlib.Path(self.build_lib) / "sonic_ws" / ("_native" + suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        browser = pathlib.Path(self.build_lib) / "sonic_ws" / "_browser"
        browser.mkdir(parents=True, exist_ok=True)
        for name in ("bundle.js", "bundle.wasm"):
            shutil.copy2(ROOT.parent / "bundled" / name, browser / name)


setup(cmdclass={"build_py": BuildPy}, distclass=BinaryDistribution)
