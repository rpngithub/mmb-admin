import CategoriesManager from '../components/CategoriesManager';

export default function AssetCategoriesPage() {
  return (
    <CategoriesManager
      resourceKey="assetCategories"
      singular="Asset Category"
      plural="Asset Categories"
      permission="assets"
      hasImages={false}
      deleteNote="Assets in this category will have their category cleared (set to NULL)."
    />
  );
}
