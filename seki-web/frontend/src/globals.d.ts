declare const __DEV__: boolean;

interface Window {
  SekiBridge?: {
    getFcmToken(): string;
  };
  SekiBridgeReady?: boolean;
  __sekiMounted?: boolean;
}

interface Navigator {
  standalone?: boolean;
}
