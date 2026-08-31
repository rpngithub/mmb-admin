import { Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ProtectedRoute from './features/auth/ProtectedRoute';
import RequirePermission from './features/auth/RequirePermission';
import Login from './features/auth/Login';
import Dashboard from './pages/Dashboard';
import UsersPage from './pages/UsersPage';
import AdminsPage from './pages/AdminsPage';
import TemplatesPage from './pages/TemplatesPage';
import FramesPage from './pages/FramesPage';
import FrameCategoriesPage from './pages/FrameCategoriesPage';
import QuotaPacksPage from './pages/QuotaPacksPage';
import HomepageCategoriesPage from './pages/HomepageCategoriesPage';
import BulkImportPage from './pages/BulkImportPage';
import ActivityLogsPage from './pages/ActivityLogsPage';
import RolesPage from './pages/RolesPage';
import PlansPage from './pages/PlansPage';
import AppSettingsPage from './pages/AppSettingsPage';
import TemplateCategoriesPage from './pages/TemplateCategoriesPage';
import BusinessCategoriesPage from './pages/BusinessCategoriesPage';
import BrandSeriesPage from './pages/BrandSeriesPage';
import VariantsPage from './pages/VariantsPage';
import AssetsPage from './pages/AssetsPage';
import AssetCategoriesPage from './pages/AssetCategoriesPage';
import TemplateSizesPage from './pages/TemplateSizesPage';
import FaqsPage from './pages/FaqsPage';
import TestimonialsPage from './pages/TestimonialsPage';
import SpecialEventsPage from './pages/SpecialEventsPage';
import CouponsPage from './pages/CouponsPage';
import LanguagesPage from './pages/LanguagesPage';
import FontsPage from './pages/FontsPage';
import FeedbackPage from './pages/FeedbackPage';
import NotificationCategoriesPage from './pages/NotificationCategoriesPage';
import NotificationTemplatesPage from './pages/NotificationTemplatesPage';
import NotificationCampaignsPage from './pages/NotificationCampaignsPage';
import UserNotificationsPage from './pages/UserNotificationsPage';
import GenericResourcePage from './pages/GenericResourcePage';
import NotFound from './pages/NotFound';
import { RESOURCES } from './resources';

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />

        <Route
          path="users"
          element={
            <RequirePermission domain="users">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="admins"
          element={
            <RequirePermission domain="admins">
              <AdminsPage />
            </RequirePermission>
          }
        />
        <Route
          path="templates"
          element={
            <RequirePermission domain="templates">
              <TemplatesPage />
            </RequirePermission>
          }
        />
        {/* Frames and their categories share the `frames` permission domain. */}
        <Route
          path="frames"
          element={
            <RequirePermission domain="frames">
              <FramesPage />
            </RequirePermission>
          }
        />
        <Route
          path="frame-categories"
          element={
            <RequirePermission domain="frames">
              <FrameCategoriesPage />
            </RequirePermission>
          }
        />
        {/* Top-up packs are commerce, not content: `quota_packs` is held by
            super_admin out of the box, so a content_admin gets a 403 here. */}
        <Route
          path="quota-packs"
          element={
            <RequirePermission domain="quota_packs">
              <QuotaPacksPage />
            </RequirePermission>
          }
        />
        <Route
          path="homepage-categories"
          element={
            <RequirePermission domain="categories">
              <HomepageCategoriesPage />
            </RequirePermission>
          }
        />
        {/* Bulk CSV import — self-gates permission (needs read on categories OR variants). */}
        <Route path="bulk-import" element={<BulkImportPage />} />
        {/* Notifications. Templates, categories and the delivery log run on
            `notifications` — a content_admin holds it. Campaigns run on
            `notification_campaigns`, which only super_admin has: every campaign
            endpoint 403s for anyone else, so the guard matches the API rather
            than letting them into a screen that cannot load. */}
        <Route
          path="notification-templates"
          element={
            <RequirePermission domain="notifications">
              <NotificationTemplatesPage />
            </RequirePermission>
          }
        />
        <Route
          path="notification-categories"
          element={
            <RequirePermission domain="notifications">
              <NotificationCategoriesPage />
            </RequirePermission>
          }
        />
        <Route
          path="notification-campaigns"
          element={
            <RequirePermission domain="notification_campaigns">
              <NotificationCampaignsPage />
            </RequirePermission>
          }
        />
        <Route
          path="notification-log"
          element={
            <RequirePermission domain="notifications">
              <UserNotificationsPage />
            </RequirePermission>
          }
        />
        <Route
          path="activity-logs"
          element={
            <RequirePermission domain="activity">
              <ActivityLogsPage />
            </RequirePermission>
          }
        />
        {/* Super-admin only in practice — feedback rows carry user contact details. */}
        <Route
          path="feedback"
          element={
            <RequirePermission domain="feedback">
              <FeedbackPage />
            </RequirePermission>
          }
        />

        {RESOURCES.filter((r) => !r.hidden).map((r) => (
          <Route
            key={r.key}
            path={`r/${r.key}`}
            element={
              <RequirePermission domain={r.permission}>
                {r.key === 'roles' ? (
                  <RolesPage />
                ) : r.key === 'plans' ? (
                  <PlansPage />
                ) : r.key === 'appSettings' ? (
                  <AppSettingsPage />
                ) : r.key === 'templateCategories' ? (
                  <TemplateCategoriesPage />
                ) : r.key === 'businessCategories' ? (
                  <BusinessCategoriesPage />
                ) : r.key === 'brandSeries' ? (
                  <BrandSeriesPage />
                ) : r.key === 'variants' ? (
                  <VariantsPage />
                ) : r.key === 'assets' ? (
                  <AssetsPage />
                ) : r.key === 'assetCategories' ? (
                  <AssetCategoriesPage />
                ) : r.key === 'templateSizes' ? (
                  <TemplateSizesPage />
                ) : r.key === 'faqs' ? (
                  <FaqsPage />
                ) : r.key === 'testimonials' ? (
                  <TestimonialsPage />
                ) : r.key === 'specialEvents' ? (
                  <SpecialEventsPage />
                ) : r.key === 'coupons' ? (
                  <CouponsPage />
                ) : r.key === 'languages' ? (
                  <LanguagesPage />
                ) : r.key === 'fonts' ? (
                  <FontsPage />
                ) : (
                  <GenericResourcePage key={r.key} resource={r} />
                )}
              </RequirePermission>
            }
          />
        ))}

        <Route path="404" element={<NotFound />} />
      </Route>

      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
