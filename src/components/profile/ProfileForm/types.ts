export interface ProfileFormInitialValues {
  name: string;
  birthDate: string;
  lifeContext: string;
}

export interface ProfileFormProps {
  initialValues?: ProfileFormInitialValues;
  serverError?: string | null;
}
