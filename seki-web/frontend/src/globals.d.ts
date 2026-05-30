declare const __DEV__: boolean;

interface Window {
  SekiBridge?: {
    getFcmToken(): string;
  };
  SekiBridgeReady?: boolean;
}
