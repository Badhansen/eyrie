import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Eyrie',
    executableName: 'eyrie',
    appBundleId: 'io.github.badhansen.eyrie',
    asar: true,
    // Read from disk at run time, so they ship next to the app rather than inside the bundle.
    // `pnpm resources` (scripts/prepare-resources.ts) fills these folders.
    extraResource: ['resources/web', 'resources/grammars'],
  },
  rebuildConfig: {},
  makers: [new MakerZIP({}, ['darwin']), new MakerSquirrel({}), new MakerDeb({})],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.mts', target: 'main' },
        // The engine and its server, run as a utility process (see src/engine-host.ts).
        { entry: 'src/engine-host.ts', config: 'vite.host.config.mts', target: 'main' },
      ],
      // No renderer of its own: the window shows the UI the engine serves on 127.0.0.1.
      renderer: [],
    }),
    // Flipped at package time, before code signing.
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
