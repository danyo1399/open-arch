-- The address the limits count each upload under: an IPv4 address as it is, and an IPv6 one as
-- its /64 network ("2001:db8:1:2::/64"), as one IPv6 user can have the whole of one.
ALTER TABLE uploads ADD COLUMN ip_group TEXT;
CREATE INDEX uploads_by_ip_group ON uploads (ip_group, created_at);
-- An IPv4 address is its own group. IPv6 uploads from before this are counted from now on only.
UPDATE uploads SET ip_group = ip WHERE ip NOT LIKE '%:%';
