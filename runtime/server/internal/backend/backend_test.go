package backend

import "testing"

func TestBackendOwnership(t *testing.T) {
	dir := t.TempDir()
	a, err := Acquire(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Acquire(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	if c, err := Acquire(dir, false); err == nil {
		c.Close()
		t.Fatal("standalone acquired while IDE writers were active")
	}
	a.Close()
	b.Close()
	c, err := Acquire(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if d, err := Acquire(dir, true); err == nil {
		d.Close()
		t.Fatal("IDE acquired while standalone writer was active")
	}
	if d, err := Acquire(dir, false); err == nil {
		d.Close()
		t.Fatal("a second standalone writer acquired ownership")
	}
	c.Close()
	d, err := Acquire(dir, true)
	if err != nil {
		t.Fatal(err)
	}
	d.Close()
}
