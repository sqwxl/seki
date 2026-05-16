import { useEffect,useState } from "preact/hooks";

export function ErrorState({ message }: { message: string }) {
  return <p>{message}</p>;
}

export function LoadingState() {
  return <p>Loading...</p>;
}

export function useLazyModule<T>(loader: () => Promise<T>) {
  const [mod, setMod] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((next) => {
        if (!cancelled) {
          setMod(next);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loader]);

  return { mod, error };
}
