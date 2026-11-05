-- The address the limits count each upload under: an IPv4 address as it is, and an IPv6 one as
-- its /64 network ("2001:db8:1:2::/64"), as one IPv6 user can have the whole of one. The server
-- fills it in for uploads recorded before this, as it opens the database (groupAddresses).
ALTER TABLE uploads ADD COLUMN ip_group TEXT;
CREATE INDEX uploads_by_ip_group ON uploads (ip_group, created_at);
