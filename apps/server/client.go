package main

import (
	"net"
	"net/http"
	"strings"
)

// TrustProxy says which proxy in front of the server to believe about who sent a request.
// Headers are only believed when there's a proxy that sets them: otherwise anyone could
// choose the address they're recorded with.
type TrustProxy string

const (
	// Nothing in front: the connection's address.
	TrustNone TrustProxy = "none"
	// A reverse proxy (Caddy, nginx, a platform's load balancer) that adds the address it saw to X-Forwarded-For.
	TrustForwarded TrustProxy = "forwarded"
	// Cloudflare's proxy, which sets CF-Connecting-IP, CF-IPCountry and CF-Ray.
	TrustCloudflare TrustProxy = "cloudflare"
)

var trustProxies = []TrustProxy{TrustNone, TrustForwarded, TrustCloudflare}

// ClientOf is who sent a request, as far as the server can tell.
func ClientOf(r *http.Request, trust TrustProxy) Client {
	ip := r.RemoteAddr
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		ip = host
	}
	c := Client{UserAgent: r.Header.Get("User-Agent"), Origin: r.Header.Get("Origin"), Referer: r.Header.Get("Referer")}
	switch trust {
	case TrustForwarded:
		// The proxy appends the address it saw, so the last one is the only one it vouches for.
		forwarded := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		if last := strings.TrimSpace(forwarded[len(forwarded)-1]); last != "" {
			ip = last
		}
	case TrustCloudflare:
		if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cf != "" {
			ip = cf
		}
		if country := r.Header.Get("CF-IPCountry"); country != "XX" {
			c.Country = country
		}
		c.Ray = r.Header.Get("CF-Ray")
	}
	// An IPv4 address the way IPv6 sockets report it ("::ffff:203.0.113.7"), as plain IPv4.
	if parsed := net.ParseIP(ip); parsed != nil && parsed.To4() != nil {
		ip = parsed.To4().String()
	}
	c.IP = ip
	return c
}
