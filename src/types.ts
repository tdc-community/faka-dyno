export type UploadProvider = "primary" | "imgbb";

export type MetricKey = "whp" | "wtq" | "psi" | "afr" | "rpm";

export interface DynoData {
  model: string;
  engine: string;
  plate: string;
  drivetrain: string;
  extTemp: string;
  humidity: string;
  correctionFactor: string;
  operator: string;
  owner: string;
  mechanicNotes: string;
  whp: number;
  wtq: number;
  psi: number;
  afr: number;
  rpm: number;
}

export interface SliderItem {
  key: MetricKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface PersistedState {
  data: DynoData;
  showHp: boolean;
  showTq: boolean;
}

export interface RecentUpload {
  url: string;
  provider: UploadProvider | "unknown";
  createdAt: number;
  fileName: string;
}

export interface ToastState {
  message: string;
  tone: "info" | "success" | "error";
}