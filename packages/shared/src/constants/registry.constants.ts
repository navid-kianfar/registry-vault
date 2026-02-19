import { RegistryType } from '../enums';

export const REGISTRY_LABELS: Record<RegistryType, string> = {
  [RegistryType.Docker]: 'Docker',
  [RegistryType.NuGet]: 'NuGet',
  [RegistryType.NPM]: 'NPM',
};

export const REGISTRY_COLORS: Record<RegistryType, string> = {
  [RegistryType.Docker]: '#2496ED',
  [RegistryType.NuGet]: '#7B3FBF',
  [RegistryType.NPM]: '#CB3837',
};

export const REGISTRY_DEFAULT_PORTS: Record<RegistryType, number> = {
  [RegistryType.Docker]: 5000,
  [RegistryType.NuGet]: 5001,
  [RegistryType.NPM]: 4873,
};
