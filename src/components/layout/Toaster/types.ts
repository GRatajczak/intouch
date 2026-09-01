export type ToastVariant = "success" | "error";

export interface ToastMessage {
  id: number;
  variant: ToastVariant;
  message: string;
}
