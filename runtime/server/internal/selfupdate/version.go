// Package selfupdate lets an installed standalone backend replace itself with a newer release.
//
// It runs the same published install command a person would paste into a terminal, pinned to the
// release the page offered. That command downloads and verifies the package, stages the files,
// keeps the data and restores the previous service when it fails. The only thing added here is to
// run it detached from this process, because it stops the very service that started it.
package selfupdate

import (
	"fmt"
	"regexp"
	"strconv"
)

// The same shape the installer scripts accept for --version.
var versionPattern = regexp.MustCompile(`^[0-9][0-9A-Za-z.+-]*$`)

// releaseVersion is what the project publishes: X.Y.Z, optionally followed by -standalone.N.
var releaseVersion = regexp.MustCompile(`^(\d+)\.(\d+)\.(\d+)(?:-standalone\.(\d+))?$`)

// ValidVersion reports whether the text is safe to put in a download URL and a file name.
func ValidVersion(version string) bool {
	return versionPattern.MatchString(version) && len(version) <= 40
}

func parts(version string) ([4]int, error) {
	match := releaseVersion.FindStringSubmatch(version)
	if match == nil {
		return [4]int{}, fmt.Errorf("unrecognized version %q", version)
	}
	var out [4]int
	for i := 0; i < 3; i++ {
		n, err := strconv.Atoi(match[i+1])
		if err != nil {
			return out, err
		}
		out[i] = n
	}
	// A plain release is newer than any -standalone.N build of the same number.
	out[3] = int(^uint(0) >> 1)
	if match[4] != "" {
		n, err := strconv.Atoi(match[4])
		if err != nil {
			return out, err
		}
		out[3] = n
	}
	return out, nil
}

// Compare returns -1, 0 or 1 for a < b, a == b, a > b.
func Compare(a, b string) (int, error) {
	pa, err := parts(a)
	if err != nil {
		return 0, err
	}
	pb, err := parts(b)
	if err != nil {
		return 0, err
	}
	for i := range pa {
		if pa[i] != pb[i] {
			if pa[i] < pb[i] {
				return -1, nil
			}
			return 1, nil
		}
	}
	return 0, nil
}
