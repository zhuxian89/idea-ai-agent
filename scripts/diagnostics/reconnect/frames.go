package main

import (
	"encoding/binary"
	"encoding/json"
	"io"
	"time"
)

// Observe the upgraded byte stream without buffering or rewriting forwarded data.
// Only small ping/pong IDs and frame sizes enter the diagnostic log.
type frameObserver struct {
	header                  []byte
	need                    int
	remaining, size, offset uint64
	mask                    []byte
	prefix                  []byte
	opcode                  byte
	started                 time.Time
	emit                    func(map[string]any)
}

func (o *frameObserver) feed(data []byte) {
	for len(data) > 0 {
		if o.need == 0 {
			o.need = 2
			o.started = time.Now()
		}
		if len(o.header) < o.need {
			n := min(o.need-len(o.header), len(data))
			o.header = append(o.header, data[:n]...)
			data = data[n:]
			if len(o.header) < o.need {
				continue
			}
			if o.need == 2 {
				o.opcode = o.header[0] & 15
				switch o.header[1] & 127 {
				case 126:
					o.need += 2
				case 127:
					o.need += 8
				}
				if o.header[1]&128 != 0 {
					o.need += 4
				}
				if len(o.header) < o.need {
					continue
				}
			}
			maskOffset := 2
			switch o.header[1] & 127 {
			case 126:
				o.size = uint64(binary.BigEndian.Uint16(o.header[2:4]))
				maskOffset = 4
			case 127:
				o.size = binary.BigEndian.Uint64(o.header[2:10])
				maskOffset = 10
			default:
				o.size = uint64(o.header[1] & 127)
			}
			if o.header[1]&128 != 0 {
				o.mask = o.header[maskOffset : maskOffset+4]
			}
			o.remaining = o.size
		}
		n := int(min(uint64(len(data)), o.remaining))
		for i := 0; i < n && len(o.prefix) < 512; i++ {
			b := data[i]
			if len(o.mask) != 0 {
				b ^= o.mask[(o.offset+uint64(i))%4]
			}
			o.prefix = append(o.prefix, b)
		}
		o.offset += uint64(n)
		o.remaining -= uint64(n)
		data = data[n:]
		if o.remaining != 0 {
			continue
		}
		event := map[string]any{"opcode": o.opcode, "bytes": o.size, "frame_ms": time.Since(o.started).Milliseconds()}
		logFrame := o.size >= 65536 || o.opcode >= 8
		if o.opcode == 1 && o.header[0]&128 != 0 && o.size <= 512 {
			var message struct {
				Type string `json:"type"`
				ID   string `json:"id"`
			}
			if json.Unmarshal(o.prefix, &message) == nil && (message.Type == "ping" || message.Type == "pong") {
				event["kind"], event["probe"] = message.Type, clip(message.ID, 100)
				logFrame = true
			}
		}
		if o.opcode == 8 && len(o.prefix) >= 2 {
			event["code"] = binary.BigEndian.Uint16(o.prefix[:2])
		}
		if logFrame {
			o.emit(event)
		}
		o.header, o.mask, o.prefix = nil, nil, nil
		o.need, o.size, o.remaining, o.offset = 0, 0, 0, 0
	}
}

type observedBody struct {
	io.ReadWriteCloser
	read, write frameObserver
}

func (b *observedBody) Read(p []byte) (int, error) {
	n, err := b.ReadWriteCloser.Read(p)
	b.read.feed(p[:n])
	return n, err
}

func (b *observedBody) Write(p []byte) (int, error) {
	n, err := b.ReadWriteCloser.Write(p)
	b.write.feed(p[:n])
	return n, err
}
