package sysstats

import (
	"testing"
	"time"
)

func TestReadReportsPlausibleValues(t *testing.T) {
	sample, err := NewCollector().Read()
	if err != nil {
		t.Fatal(err)
	}
	if sample.CPUCores < 1 || sample.MemTotal == 0 {
		t.Fatalf("missing machine facts: %+v", sample)
	}
	if sample.CPUPercent < 0 || sample.CPUPercent > 100 || sample.MemPercent <= 0 || sample.MemPercent > 100 {
		t.Fatalf("percentages out of range: %+v", sample)
	}
	if sample.MemUsed == 0 || sample.MemUsed > sample.MemTotal {
		t.Fatalf("memory used must be within the total: %+v", sample)
	}
	if time.Since(time.UnixMilli(sample.SampledAtMS)) > time.Minute {
		t.Fatalf("stale timestamp: %+v", sample)
	}
}

func TestReadSharesOneReadingWithinTheInterval(t *testing.T) {
	collector := NewCollector()
	first, err := collector.Read()
	if err != nil {
		t.Fatal(err)
	}
	second, err := collector.Read()
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("a second reader within the interval must get the same reading:\n%+v\n%+v", first, second)
	}
}

func TestReadRefreshesAfterTheInterval(t *testing.T) {
	collector := NewCollector()
	first, err := collector.Read()
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(minInterval + 100*time.Millisecond)
	second, err := collector.Read()
	if err != nil {
		t.Fatal(err)
	}
	if second.SampledAtMS <= first.SampledAtMS {
		t.Fatalf("reading was not refreshed: %d then %d", first.SampledAtMS, second.SampledAtMS)
	}
}

func TestClamp(t *testing.T) {
	for in, want := range map[float64]float64{-3: 0, 0: 0, 42.5: 42.5, 100: 100, 130: 100} {
		if got := clamp(in); got != want {
			t.Errorf("clamp(%v)=%v want %v", in, got, want)
		}
	}
}
