import CategoriesManager from '../components/CategoriesManager';

export default function TemplateCategoriesPage() {
  return (
    <CategoriesManager
      resourceKey="templateCategories"
      singular="Template Category"
      plural="Template Categories"
      permission="categories"
      iconSlot="template_category_icon"
      thumbnailSlot="template_category_thumbnail"
      hasHomepage
      deleteNote="Templates in this category will have their category cleared (set to NULL)."
    />
  );
}
