import CategoriesManager from '../components/CategoriesManager';

export default function AssetCategoriesPage() {
  return (
    <CategoriesManager
      resourceKey="assetCategories"
      singular="Asset Category"
      plural="Asset Categories"
      permission="assets"
      hasImages={false}
      // Import these before assets: an assets sheet naming a category that
      // doesn't exist yet has its row skipped, never auto-created.
      importEntity="asset-categories"
      deleteNote="Assets in this category will have their category cleared (set to NULL)."
    />
  );
}
