import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.0d2cfb433644485a84021a54f15337f5',
  appName: 'event-tag-flow',
  webDir: 'dist',
  server: {
    url: 'https://0d2cfb43-3644-485a-8402-1a54f15337f5.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    NFC: {
      // Enable NFC functionality
      iso14443: true,
      iso15693: true,
      iso18092: true
    }
  }
};

export default config;