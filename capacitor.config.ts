import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'SiempreCerca',
  webDir: 'www',
  plugins: {
    LocalNotifications: {
      iconColor: '#7715c7',
      sound: 'alarmmelodia.wav'
    }
  }
};

export default config;
