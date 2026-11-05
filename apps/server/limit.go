package main

import "sync"

// DefaultFailedLookupsPerHour is how many requests for workspaces that aren't there one address
// can make in an hour, before it can't look up any for the rest of it.
const DefaultFailedLookupsPerHour = 60

// lookups counts each address's requests for workspaces that aren't there, over the last hour,
// so nobody can try IDs until they find one. It's in memory: a restart forgets it, which only
// gives someone trying IDs a fresh hour.
type lookups struct {
	mu sync.Mutex
	// Each address's failed lookups in the last hour, oldest first, in milliseconds since the epoch.
	failed map[string][]int64
	// Failed lookups noted since addresses with none left in the hour were last forgotten.
	sinceSweep int
}

// recent drops an address's lookups older than an hour, and returns the rest. The caller holds mu.
func (l *lookups) recent(ip string, now int64) []int64 {
	times := l.failed[ip]
	kept := 0
	for kept < len(times) && times[kept] <= now-hour {
		kept++
	}
	times = times[kept:]
	if len(times) == 0 {
		delete(l.failed, ip)
	} else {
		l.failed[ip] = times
	}
	return times
}

// wait is how many milliseconds until an address can look up workspaces again, or 0 if it can now.
func (l *lookups) wait(ip string, limit int, now int64) int64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failed == nil {
		return 0
	}
	times := l.recent(ip, now)
	if len(times) < limit {
		return 0
	}
	// When the one that brings it under the limit is an hour old.
	return times[len(times)-limit] + hour - now
}

// fail notes a lookup of a workspace that isn't there. Now and then it forgets addresses with none
// left in the hour, so many addresses each trying a few don't fill memory.
func (l *lookups) fail(ip string, limit int, now int64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.failed == nil {
		l.failed = map[string][]int64{}
	}
	times := append(l.recent(ip, now), now)
	// No more than the limit are needed to know when it's under again.
	if len(times) > limit {
		times = times[len(times)-limit:]
	}
	l.failed[ip] = times
	if l.sinceSweep++; l.sinceSweep >= 1000 {
		l.sinceSweep = 0
		for other := range l.failed {
			l.recent(other, now)
		}
	}
}
