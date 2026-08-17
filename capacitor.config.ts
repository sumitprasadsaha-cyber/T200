import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.academyconnect.app',
  appName: 'Academy Connect',
  webDir: 'dist',
  plugins: {
    ScreenOrientation: {
      orientation: 'portrait'
    }
  }
};

export default config;

