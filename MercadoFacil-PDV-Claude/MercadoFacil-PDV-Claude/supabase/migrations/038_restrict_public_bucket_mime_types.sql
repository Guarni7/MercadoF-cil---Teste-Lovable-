-- Priority 3 fix (Security Gate): the "public" Storage bucket had
-- allowed_mime_types = null (no restriction) and public read enabled — any
-- authenticated user could upload arbitrary files (.html, .svg with embedded
-- <script>, executables) into their own company folder and get an immediate
-- public URL on the project's own Supabase Storage domain.
--
-- This is the real, server-enforced boundary — Storage rejects any upload
-- whose declared content-type isn't in this list, regardless of what the
-- client claims or how the frontend's own extension check was bypassed.
-- List mirrors src/api/dataClient.js's UPLOAD_MIME_BY_EXT: product/logo
-- images, and the XML/CSV/XLSX formats used by NF-e purchase import and
-- customer/product bulk import. No html/svg/javascript/executable types.

update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/csv', 'text/plain',
  'text/xml', 'application/xml',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'public';
