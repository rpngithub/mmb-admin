import { Alert, Typography } from 'antd';

const { Text } = Typography;

/**
 * A save failure from the AI API: the message plus EVERY details[] entry as a
 * list. Schema ↔ route checks return one entry per problem, each naming the
 * route, so showing only the first would hide the rest. `error` is the
 * `{ message, items }` from lib/ai serverErrors / applyServerErrors.
 */
export default function AiServerErrors({ error, style }) {
  if (!error) return null;
  const items = error.items || [];
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16, ...style }}
      message={error.message}
      description={
        items.length ? (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {items.map((d, i) => (
              <li key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {d.field && (
                  <Text code style={{ fontSize: 12 }}>
                    {d.field}
                  </Text>
                )}{' '}
                {d.message}
              </li>
            ))}
          </ul>
        ) : undefined
      }
    />
  );
}
