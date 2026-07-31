import CategoriesManager from '../components/CategoriesManager';

export default function BusinessCategoriesPage() {
  return (
    <CategoriesManager
      resourceKey="businessCategories"
      singular="Industry"
      plural="Industries"
      permission="categories"
      iconSlot="business_category_icon"
      thumbnailSlot="business_category_thumbnail"
      hasTags
      deleteNote="Businesses/products in this industry will have their industry cleared (set to NULL); tag links are removed."
    />
  );
}
