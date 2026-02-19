import { useParams } from 'react-router-dom';
import { useRegistryConnections } from '@/services/queries/settings.queries';

export function useRegistryConnection() {
  const { connectionId } = useParams<{ connectionId: string }>();
  const { data: connections } = useRegistryConnections();
  const connection = connections?.find((c) => c.id === connectionId);
  return { connectionId, connection };
}
