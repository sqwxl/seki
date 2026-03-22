export type WebRequestError = {
  status: number;
  message: string;
  field?: string;
};

export async function postForm(
  url: string,
  formData: FormData,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams();
  formData.forEach((value, key) => body.append(key, String(value)));
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    throw {
      status: response.status,
      message: data.error ?? "Request failed",
      field: data.field,
    } satisfies WebRequestError;
  }
  return data;
}
