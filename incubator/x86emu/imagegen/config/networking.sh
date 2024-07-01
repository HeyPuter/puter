rmmod ne2k-pci && modprobe ne2k-pci
ifconfig enp0s5 192.168.1.5 netmask 255.255.255.0 up
route add default gw 192.168.1.1
echo "nameserver 1.1.1.1" > /etc/resolv.conf
dhcpcd -w4 enp0s5
