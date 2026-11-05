package main

import (
	"net/http"
	"testing"
)

func TestLimitsLookupsOfWorkspacesThatArentThere(t *testing.T) {
	eachStore(t, func(t *testing.T, h *harness) {
		h.server.FailedLookupsPerHour = 3
		c := h.create(file(7, 64))
		unknown := "/v1/workspaces/AAAAAAAAAAAAAAAAAAAAAA"

		// Workspaces that are there don't count, however often they're asked for.
		for i := 0; i < 10; i++ {
			expect(t, h.send("GET", "/v1/workspaces/"+c.ID, nil, nil).StatusCode, 200, "a workspace that's there")
		}
		// Each way of asking about one that isn't does: a GET, a PUT (which would answer 401 for
		// one that's there), and an ID that couldn't be one.
		expect(t, h.send("GET", unknown, nil, nil).StatusCode, 404, "first")
		h.now += 1000
		expect(t, h.send("PUT", unknown, file(8, 64), map[string]string{"Authorization": "Bearer x"}).StatusCode, 404, "second")
		h.now += 1000
		expect(t, h.send("GET", "/v1/workspaces/short", nil, nil).StatusCode, 404, "third")

		// Past the limit, it can't ask about any, even one that's there.
		for _, path := range []string{unknown, "/v1/workspaces/" + c.ID, "/v1/workspaces/" + c.ID + "/" + c.Hash} {
			r := h.send("GET", path, nil, nil)
			expect(t, r.StatusCode, http.StatusTooManyRequests, "limited "+path)
			// Until the first of the three is an hour old: 2 seconds ago.
			expect(t, r.Header.Get("Retry-After"), "3598", "retry after")
		}
		expect(t, decode[map[string]string](t, h.send("DELETE", unknown, nil, nil))["error"],
			"Too many requests from this address for shared workspaces that aren't there: at most 3 an hour. Try again later.", "message")
		// Uploading a new workspace names none, so it still can.
		expect(t, h.send("POST", "/v1/workspaces", file(9, 64), nil).StatusCode, 201, "upload")

		// Another address can.
		h.ip = "198.51.100.1"
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID, nil, nil).StatusCode, 200, "another address")

		// An hour after the first, it's under the limit again, for one more.
		h.ip = "203.0.113.7"
		h.now += hour - 2000
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID, nil, nil).StatusCode, 200, "an hour later")
		expect(t, h.send("GET", unknown, nil, nil).StatusCode, 404, "one more")
		expect(t, h.send("GET", "/v1/workspaces/"+c.ID, nil, nil).StatusCode, http.StatusTooManyRequests, "limited again")
	})
}

func TestForgetsAddressesWithNoneLeftInTheHour(t *testing.T) {
	var l lookups
	for i := 0; i < 999; i++ {
		l.fail("192.0.2."+string(rune('a'+i%26))+string(rune('a'+i/26)), 60, 0)
	}
	expect(t, len(l.failed) > 0, true, "remembered")
	// The thousandth, an hour later, sweeps out the rest.
	l.fail("198.51.100.1", 60, hour+1)
	expect(t, len(l.failed), 1, "addresses left")
	// And an address only keeps as many as the limit.
	for i := 0; i < 100; i++ {
		l.fail("203.0.113.7", 5, hour+2)
	}
	expect(t, len(l.failed["203.0.113.7"]), 5, "kept")
}
