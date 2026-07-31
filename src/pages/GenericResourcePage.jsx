import { adminApi } from '../features/api/adminApi';
import ResourceManager from '../components/ResourceManager';

/**
 * Wires a generic resource config to the generated RTK Query endpoints and
 * renders the shared ResourceManager. Endpoints are resolved by name from the
 * factory-generated set. Mount this with a `key={resource.key}` so switching
 * resources remounts (dynamic hook identity stays stable within a mount).
 */
export default function GenericResourcePage({ resource }) {
  const { list, create, update, remove } = resource.endpoints;

  const { data, isLoading, isFetching, refetch } = adminApi.endpoints[list].useQuery();
  const [createTrigger] = adminApi.endpoints[create].useMutation();
  const [updateTrigger] = adminApi.endpoints[update].useMutation();
  const [removeTrigger] = adminApi.endpoints[remove].useMutation();

  const mutations = {
    create: (body) => createTrigger(body).unwrap(),
    update: (id, body) => updateTrigger({ id, body }).unwrap(),
    remove: (id) => removeTrigger(id).unwrap(),
  };

  return (
    <ResourceManager
      resource={{
        singular: resource.title,
        plural: resource.name,
        idField: resource.idField,
        permission: resource.permission,
        columns: resource.columns,
        fields: resource.fields,
      }}
      rows={data || []}
      loading={isLoading}
      fetching={isFetching}
      onReload={refetch}
      mutations={mutations}
    />
  );
}
