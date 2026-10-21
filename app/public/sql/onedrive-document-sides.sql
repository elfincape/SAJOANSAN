-- Existing food_transport/livestock_transport records remain the front image.
begin;
alter table public.driver_documents drop constraint if exists driver_documents_document_type_check;
alter table public.driver_documents add constraint driver_documents_document_type_check check(document_type in (
 'food_transport','food_transport_back','livestock_transport','livestock_transport_back',
 'freight_license','vehicle_registration','identity','health_certificate'));
alter table public.onedrive_uploads add column if not exists content_hash text;
notify pgrst,'reload schema';
commit;
