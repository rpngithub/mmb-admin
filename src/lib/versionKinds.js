/**
 * Template designs and frames share one version model (language — or
 * text-free — × template size, each version with its own bundle) and therefore
 * one grid + bundle UI. Everything that differs between the two lives here, so
 * TemplateVersionGrid / TemplateBundlePanel take a `kind` instead of growing
 * if/else branches.
 *
 * `parentArg` is how that kind's version mutations name the parent uid (used
 * only for cache invalidation); `parentIdField` is the numeric parent id key
 * the version create body takes.
 */

export const TEMPLATE_VERSIONS = {
  key: 'template',
  permission: 'templates',
  parent: 'design',
  parentArg: 'familyUid',
  parentIdField: 'family_id',
  endpoints: {
    create: 'templateVersionCreate',
    update: 'templateVersionUpdate',
    remove: 'templateVersionRemove',
    bundleConfirm: 'templateBundleConfirm',
    bundleReset: 'templateBundleReset',
  },
  fileTarget: (uid) => ({ type: 'template_file', template_uid: uid }),
  folder: (uid) => `templates/${uid}/`,
  zipName: 'template-bundle.zip',
  documentName: 'template.json',
  documentLabel: 'template document',
  resetNote: '',
};

export const FRAME_VERSIONS = {
  key: 'frame',
  permission: 'frames',
  parent: 'frame',
  parentArg: 'frameUid',
  parentIdField: 'frame_id',
  endpoints: {
    create: 'frameVersionCreate',
    update: 'frameVersionUpdate',
    remove: 'frameVersionRemove',
    bundleConfirm: 'frameBundleConfirm',
    bundleReset: 'frameBundleReset',
  },
  fileTarget: (uid) => ({ type: 'frame_file', frame_version_uid: uid }),
  folder: (uid) => `frames/${uid}/`,
  zipName: 'frame-bundle.zip',
  documentName: 'frame.json',
  documentLabel: 'frame document',
  // Migration-058 thumbnails live outside the folder and survive a reset.
  resetNote:
    ' It also clears the saved content (and the thumbnail, if it came from a bundle). A live version goes back to draft.',
};

/** The parent-uid argument a version mutation of this kind expects. */
export const parentArgs = (kind, parentUid) => ({ [kind.parentArg]: parentUid });
