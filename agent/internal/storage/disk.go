package storage

import (
	"fmt"
	"math"

	"golang.org/x/sys/unix"
)

// diskUsage reports the filesystem holding path. Used bytes follow df: the
// blocks the filesystem considers occupied, including the reserve that is free
// but not available to an unprivileged writer.
func diskUsage(path string) (Disk, error) {
	var stat unix.Statfs_t
	statErr := unix.Statfs(path, &stat)
	if statErr != nil {
		return Disk{}, fmt.Errorf("statfs %s: %w", path, statErr)
	}

	blockSize := uint64(stat.Bsize)
	total := stat.Blocks * blockSize
	free := stat.Bavail * blockSize
	used := (stat.Blocks - stat.Bfree) * blockSize

	usage := Disk{
		TotalBytes: clampToInt64(total),
		UsedBytes:  clampToInt64(used),
		FreeBytes:  clampToInt64(free),
	}
	if total > 0 {
		ratio := float64(used) / float64(total) * 100
		usage.UsedPercent = math.Round(ratio*100) / 100
	}
	return usage, nil
}

func clampToInt64(value uint64) int64 {
	if value > math.MaxInt64 {
		return math.MaxInt64
	}
	return int64(value)
}
