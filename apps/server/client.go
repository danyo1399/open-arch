package main

import (
	"net"
	"net/http"
	"strconv"
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
	// A proxy's word is taken only for an address: anything else in the header means the proxy
	// isn't the one the server was told about, and the connection's address is all there is.
	valid := func(s string) bool { return net.ParseIP(s) != nil }
	switch trust {
	case TrustForwarded:
		// The proxy appends the address it saw, so the last one is the only one it vouches for.
		// Some add its port too, as "203.0.113.7:4000" or "[2001:db8::1]:4000", and some put an
		// IPv6 one in brackets without a port, as "[2001:db8::1]".
		forwarded := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		last := strings.TrimSpace(forwarded[len(forwarded)-1])
		if host, port, err := net.SplitHostPort(last); err == nil && valid(host) {
			if _, err := strconv.ParseUint(port, 10, 16); err == nil {
				last = host
			}
		} else if strings.HasPrefix(last, "[") && strings.HasSuffix(last, "]") && valid(last[1:len(last)-1]) {
			last = last[1 : len(last)-1]
		}
		if valid(last) {
			ip = last
		}
	case TrustCloudflare:
		if cf := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); valid(cf) {
			ip = cf
		}
		if country := r.Header.Get("CF-IPCountry"); country != "XX" {
			c.Country = country
		}
		c.Ray = r.Header.Get("CF-Ray")
	}
	// Written one way, so the limits, blocks and uploads --ip all match it: an IPv4 address the
	// way IPv6 sockets report it ("::ffff:203.0.113.7") as plain IPv4, and IPv6 in its short form.
	if parsed := net.ParseIP(ip); parsed != nil {
		if v4 := parsed.To4(); v4 != nil {
			ip = v4.String()
		} else {
			ip = parsed.String()
		}
	}
	c.IP = ip
	c.Group = AddressGroup(ip)
	return c
}

// AddressGroup is what the limits count an address as: an IPv4 address as it is, and an IPv6 one
// as its /64 network, like "2001:db8:1:2::/64". Someone with IPv6 is usually given a whole /64,
// so counting each of its addresses alone would let them make as many as they like. Anything
// that isn't an address is its own group.
func AddressGroup(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return ip
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.String()
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// BlockTarget is what block-ip and uploads --ip take, written the way the server records it: an
// IP address, or an IPv6 /64. It's empty for anything else.
func BlockTarget(target string) string {
	if strings.Contains(target, "/") {
		ip, network, err := net.ParseCIDR(target)
		if err != nil || ip.To4() != nil {
			return ""
		}
		if ones, bits := network.Mask.Size(); ones != 64 || bits != 128 {
			return ""
		}
		return AddressGroup(ip.String())
	}
	parsed := net.ParseIP(target)
	if parsed == nil {
		return ""
	}
	if v4 := parsed.To4(); v4 != nil {
		return v4.String()
	}
	return parsed.String()
}
