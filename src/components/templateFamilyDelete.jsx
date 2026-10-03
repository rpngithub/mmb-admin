import { Button, Input, Space, Typography, App } from 'antd';
import { adminApi } from '../features/api/adminApi';
import { num } from '../lib/templateFamilies';

const { Text, Paragraph } = Typography;

/**
 * Deleting a design deletes EVERY version in it, so the confirm is loud: it
 * spells out the version count, offers "Make inactive instead" (the preferred
 * way to take a design down), and only enables Delete once the admin has typed
 * the design's name.
 *
 * Returns `confirmDelete(family, { onDeleted })`. `family` needs uid, name and,
 * when known, version_count.
 */
export function useConfirmFamilyDelete() {
  const { message, modal } = App.useApp();
  const [removeFamily] = adminApi.endpoints.templateFamilyRemove.useMutation();
  const [updateFamily] = adminApi.endpoints.templateFamilyUpdate.useMutation();

  return (family, { onDeleted } = {}) => {
    const count = family.version_count != null ? num(family.version_count) : null;
    const versionsText =
      count == null ? 'all of its versions' : `${count} version${count === 1 ? '' : 's'}`;
    const expected = String(family.name || '').trim();
    let typed = '';

    const makeInactive = async () => {
      try {
        await updateFamily({ uid: family.uid, body: { status: 'inactive' } }).unwrap();
        message.success(`“${family.name}” is now inactive`);
        dialog.destroy();
      } catch (err) {
        message.error(err?.message || 'Could not make the design inactive.');
      }
    };

    const dialog = modal.confirm({
      title: `Delete “${family.name}” and ${versionsText}?`,
      width: 520,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Paragraph style={{ margin: 0 }}>
            This permanently deletes the design <Text strong>and {versionsText}</Text> — every
            language and every size, with their bundles. It cannot be undone.
          </Paragraph>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            To take it out of the app, make it <Text strong>inactive</Text> instead. You can
            republish an inactive design later.
          </Paragraph>
          <Text>
            Type <Text code>{expected}</Text> to confirm:
          </Text>
          <Input
            autoFocus
            onChange={(e) => {
              typed = e.target.value;
              dialog.update({
                okButtonProps: { danger: true, disabled: typed.trim() !== expected },
              });
            }}
          />
        </Space>
      ),
      okText: 'Delete permanently',
      okButtonProps: { danger: true, disabled: true },
      footer: (_, { OkBtn, CancelBtn }) => (
        <Space>
          <CancelBtn />
          <Button onClick={makeInactive}>Make inactive instead</Button>
          <OkBtn />
        </Space>
      ),
      onOk: async () => {
        if (typed.trim() !== expected) return;
        try {
          await removeFamily(family.uid).unwrap();
          message.success(`“${family.name}” deleted`);
          onDeleted?.();
        } catch (err) {
          message.error(err?.message || 'Could not delete the design.');
          throw err; // keep the dialog open
        }
      },
    });
  };
}
