export interface ProfileFormInitialValues {
  name: string;
  birthDate: string;
  lifeContext: string;
  weeklyTimeBudget?: string;
  preferredChannels?: string[];
  availabilityWindows?: string[];
}

export interface ProfileFormProps {
  initialValues?: ProfileFormInitialValues;
}
