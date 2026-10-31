import { Button } from 'antd';

/**
 * Shared variant vocabulary for the Variants page, the Brand Series panel and
 * the variant editor.
 *
 * How a variant is unlocked ("option B"): every variant is SHOWN to everyone.
 * A user USES one only if their business ADDED it while subscribed (the plan's
 * brand_series value = variants added at a time), or they BOUGHT it outright —
 * a one-off payment that works forever. There is no plan ↔ variant link.
 *
 * `price` is PRE-TAX (GST is added at checkout) and `null` means not for sale.
 * Both price fields arrive as DECIMAL strings, so read them through `toAmount`.
 */
export { toAmount, withGst, formatMoney } from './quotaPacks';

export const DEACTIVATE_EXPLAINER =
  'Deactivating removes it from the catalogue and from sale. People who already bought it or added it to their business keep access.';

/**
 * Confirm + delete a variant. A variant anyone has bought can't be deleted —
 * the API answers 409 CONFLICT — so that becomes a notification suggesting
 * deactivation instead, with a one-click action when the admin can edit.
 *
 * `remove` / `update` are the triggers of the silent variantRemove /
 * variantUpdate mutations; pass `update` only when the admin may edit.
 */
export function confirmDeleteVariant({ variant, modal, message, notification, remove, update }) {
  modal.confirm({
    title: `Delete variant "${variant.name}"?`,
    content:
      'Its template associations are removed; the templates themselves are untouched. If anyone has bought this variant it can’t be deleted — deactivate it instead.',
    okText: 'Delete',
    okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await remove(variant.uid).unwrap();
        message.success('Variant deleted');
      } catch (err) {
        if (err?.status !== 409) {
          notification.error({ message: err?.message || 'Could not delete the variant.' });
          return;
        }
        const key = `variant-409-${variant.uid}`;
        const deactivate = async () => {
          try {
            await update({ uid: variant.uid, body: { is_active: 0 } }).unwrap();
            notification.destroy(key);
            message.success('Variant deactivated');
          } catch (e) {
            message.error(e?.message || 'Could not deactivate the variant.');
          }
        };
        notification.warning({
          key,
          duration: 0,
          message: err?.message || 'This variant is still referenced by other records.',
          description: `Someone has bought "${variant.name}", so it can’t be deleted. Deactivate it instead. ${DEACTIVATE_EXPLAINER}`,
          actions: update ? (
            <Button type="primary" size="small" onClick={deactivate}>
              Deactivate instead
            </Button>
          ) : undefined,
        });
      }
    },
  });
}
