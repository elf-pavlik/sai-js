export default {
  agents: [
    'https://pod.demo.hackers4peace.net/acme/profile/card#me',
    'https://pod.demo.hackers4peace.net/yoyo/profile/card#me'
  ],
  pods: {
    'https://pod.demo.hackers4peace.net/acme/profile/card#me': [
      {
        id: 'https://pod.demo.hackers4peace.net/acme-hr/',
        name: 'HR'
      },
      {
        id: 'https://pod.demo.hackers4peace.net/acme-rnd/',
        name: 'RnD'
      }
    ],
    'https://pod.demo.hackers4peace.net/yoyo/profile/card#me': [
      {
        id: 'https://pod.demo.hackers4peace.net/yoyo-eu/',
        name: 'EU'
      },
    ]
  },
  registrations: {
    'https://pod.demo.hackers4peace.net/acme-hr/': 'https://pod.demo.hackers4peace.net/acme-hr/dataRegistry/events/',
    'https://pod.demo.hackers4peace.net/acme-rnd/': 'https://pod.demo.hackers4peace.net/acme-rnd/dataRegistry/events/',
    'https://pod.demo.hackers4peace.net/yoyo-eu/': 'https://pod.demo.hackers4peace.net/yoyo-eu/dataRegistry/events/'
  }
}
